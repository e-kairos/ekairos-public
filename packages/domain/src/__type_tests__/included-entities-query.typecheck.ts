// Reproduce cross-domain entity query behavior with ekairos domain builder
// Goal: when a domain includes another domain, the resulting schema type
// should allow querying entities from the included domain via InstaQLParams.
//
// This mirrors the pattern used in app code:
//   const schema = tenderDomain.toInstantSchema();
//   db.query({ requisition_requisitions: { ... } })
//
// If the type system does not "see" requisition_requisitions as part of the
// tender schema, TypeScript will report that the value is not assignable
// (effectively treating that key as `undefined` in the query type.

import { domain } from "..";
import { i } from "@instantdb/core";
import type { InstaQLParams, ValidQuery } from "@instantdb/core";

// Minimal requisition domain (replica reducida del real, con itemGroups/items)
const requisitionDomain = domain("requisition").schema({
  entities: {
    requisition_requisitions: i.entity({
      title: i.string(),
    }),
    requisition_itemGroups: i.entity({
      name: i.string().optional(),
    }),
    requisition_requisitionItems: i.entity({
      quantity: i.number().optional(),
    }),
  },
  links: {
    // requisition_requisitions <-> requisition_itemGroups (label: itemGroups)
    requisitionItemGroupsRequisition: {
      forward: {
        on: "requisition_itemGroups",
        has: "one",
        label: "requisition",
      },
      reverse: {
        on: "requisition_requisitions",
        has: "many",
        label: "itemGroups",
      },
    },
    // requisition_itemGroups <-> requisition_requisitionItems (label: items)
    requisitionItemGroupsItems: {
      forward: {
        on: "requisition_itemGroups",
        has: "many",
        label: "items",
      },
      reverse: {
        on: "requisition_requisitionItems",
        has: "one",
        label: "itemGroup",
      },
    },
  },
  rooms: {},
});

// Minimal tender domain that *includes* requisitions
const tenderDomain = domain("tender")
  .includes(requisitionDomain)
  .schema({
    entities: {
      tenderx_tenders: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  });

// Schema used in backend services: ReturnType<typeof tenderDomain.toInstantSchema>
type TenderSchema = ReturnType<typeof tenderDomain.toInstantSchema>;

// Sanity check: the composed schema *should* expose the included entity
type TenderEntities = TenderSchema["entities"];
type HasRequisitionEntity =
  "requisition_requisitions" extends keyof TenderEntities ? true : false;
const _hasRequisitionEntity: HasRequisitionEntity = true;

// Asegurarnos también de que los links de requisition fueron enriquecidos
type RequisitionLinks =
  TenderSchema["entities"]["requisition_requisitions"]["links"];
type HasItemGroupsLink =
  "itemGroups" extends keyof RequisitionLinks ? true : false;
const _hasItemGroupsLink: HasItemGroupsLink = true;

// This is the critical bit: InstaQLParams<TenderSchema> should accept
// `requisition_requisitions` as a top-level key in the query, mirroring
// the real-world usage in TenderService.
//
// If the domain types do NOT propagate included entities correctly,
// TypeScript will complain here with something equivalent to:
//   "Type '{ ... }' is not assignable to type 'undefined'."
//
// That is the behavior we want to detect and eventually fix.
const tenderAndRequisitionQuery = {
  requisition_requisitions: {
    $: {
      where: {
        id: "req-1",
      },
    },
  },
} satisfies InstaQLParams<TenderSchema>;

// Nivel 1: acceder al link itemGroups directamente
const tenderWithGroups = {
  requisition_requisitions: {
    itemGroups: {},
  },
} satisfies InstaQLParams<TenderSchema>;

// Nivel 2: itemGroups -> items
const tenderWithGroupsAndItems = {
  requisition_requisitions: {
    itemGroups: {
      items: {},
    },
  },
} satisfies InstaQLParams<TenderSchema>;

// Nivel 3: where usando un path anidado sobre los links (similar a TenderService)
const tenderWithNestedWhere = {
  requisition_requisitions: {
    $: {
      where: {
        // path a través de itemGroups -> items (no hace falta ir hasta item.*)
        "itemGroups.items.id": "req-item-1",
      },
    },
    itemGroups: {
      items: {},
    },
  },
} satisfies InstaQLParams<TenderSchema>;

// Keep a type alias so this file is used by the compiler even if the
// value above is erased.
type _TenderAndRequisitionQuery = typeof tenderAndRequisitionQuery;
type _TenderWithGroups = typeof tenderWithGroups;
type _TenderWithGroupsAndItems = typeof tenderWithGroupsAndItems;
type _TenderWithNestedWhere = typeof tenderWithNestedWhere;

// =====================================================================================
// ValidQuery-level checks (mismatching shape should appear here, como en esolbay)
// =====================================================================================

// Caso simple: solo $ sobre requisition_requisitions
type QSimple = {
  requisition_requisitions: {
    $: { where?: { id?: string } };
  };
};
type QSimpleOk = QSimple extends ValidQuery<QSimple, TenderSchema> ? true : false;
const _qSimpleOk: QSimpleOk = true;

// Caso con itemGroups + items, sin where anidado
type QWithLinks = {
  requisition_requisitions: {
    itemGroups: {
      items: {};
    };
  };
};
type QWithLinksOk = QWithLinks extends ValidQuery<QWithLinks, TenderSchema> ? true : false;
const _qWithLinksOk: QWithLinksOk = true;

// Caso completo: $ + itemGroups + items (lo más parecido a TenderService)
type QNested = {
  requisition_requisitions: {
    $: {
      where?: {
        "itemGroups.items.id"?: string;
      };
    };
    itemGroups: {
      items: {};
    };
  };
};
type QNestedOk = QNested extends ValidQuery<QNested, TenderSchema> ? true : false;
const _qNestedOk: QNestedOk = true;

// ---------------- Invalid cases: these SHOULD NOT be assignable to ValidQuery ----------------

// 1) Entidad top-level inexistente
type QInvalidEntity = {
  requisition_requisitionz: {}; // typo en el nombre de la entidad
};
type QInvalidEntityCheck =
  QInvalidEntity extends ValidQuery<QInvalidEntity, TenderSchema> ? false : true;
const _qInvalidEntityCheck: QInvalidEntityCheck = true; // debe ser true (no asignable)

// 2) Link inexistente en requisition_requisitions
type QInvalidLink = {
  requisition_requisitions: {
    wrongLink: {}; // no existe como link
  };
};
type QInvalidLinkCheck =
  QInvalidLink extends ValidQuery<QInvalidLink, TenderSchema> ? false : true;
const _qInvalidLinkCheck: QInvalidLinkCheck = true; // debe ser true (no asignable)

// 3) Link anidado inexistente en requisition_itemGroups
type QInvalidNestedLink = {
  requisition_requisitions: {
    itemGroups: {
      wrongItems: {}; // no existe como link en requisition_itemGroups
    };
  };
};
type QInvalidNestedLinkCheck =
  QInvalidNestedLink extends ValidQuery<QInvalidNestedLink, TenderSchema> ? false : true;
const _qInvalidNestedLinkCheck: QInvalidNestedLinkCheck = true; // debe ser true (no asignable)

// 4) Path inválido en where (atributo inexistente en items)
type QInvalidWhere = {
  requisition_requisitions: {
    $: {
      where?: {
        "itemGroups.items.unknownAttr": string; // atributo inexistente en requisition_requisitionItems
      };
    };
    itemGroups: {
      items: {};
    };
  };
};
type QInvalidWhereCheck =
  QInvalidWhere extends ValidQuery<QInvalidWhere, TenderSchema> ? false : true;
const _qInvalidWhereCheck: QInvalidWhereCheck = true; // debería ser true; si no, es una limitación conocida

// =====================================================================================
// Multi-level nested domains + complex where (mimic esolbay-style complexity)
// =====================================================================================

// Dominio base adicional para aumentar complejidad
const baseDomain = domain("base").schema({
  entities: {
    base_entities: i.entity({
      name: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

// Dominio intermedio que incluye base + requisition
const midLevelDomain = domain("mid")
  .includes(baseDomain)
  .includes(requisitionDomain)
  .schema({
    entities: {
      mid_entities: i.entity({
        label: i.string(),
      }),
    },
    links: {
      // mid_entities -> requisition_requisitions (label: requisitions)
      midToRequisitions: {
        forward: {
          on: "mid_entities",
          has: "many",
          label: "requisitions",
        },
        reverse: {
          on: "requisition_requisitions",
          has: "one",
          label: "midEntity",
        },
      },
    },
    rooms: {},
  });

// Dominio de nivel superior que vuelve a incluir midLevelDomain (anidado varias veces)
const highLevelDomain = domain("high")
  .includes(midLevelDomain)
  .includes(requisitionDomain) // incluir de nuevo para agrandar el grafo
  .schema({
    entities: {
      high_roots: i.entity({
        code: i.string(),
      }),
    },
    links: {
      // high_roots -> mid_entities
      highToMid: {
        forward: {
          on: "high_roots",
          has: "many",
          label: "midEntities",
        },
        reverse: {
          on: "mid_entities",
          has: "one",
          label: "highRoot",
        },
      },
    },
    rooms: {},
  });

type HighSchema = ReturnType<typeof highLevelDomain.toInstantSchema>;

// Query compleja: filtrar requisitions por un atributo en items anidados, dentro de HighSchema
type QHighValid = {
  requisition_requisitions: {
    $: {
      where?: {
        // Requisitions que tengan al menos un item con quantity > 0
        "itemGroups.items.quantity"?: { $gt: 0 };
      };
    };
    itemGroups: {
      items: {};
    };
  };
};

type QHighValidOk = QHighValid extends ValidQuery<QHighValid, HighSchema>
  ? true
  : false;
const _qHighValidOk: QHighValidOk = true;

// Variante inválida: path con atributo inexistente en items dentro de HighSchema
type QHighInvalidWhere = {
  requisition_requisitions: {
    $: {
      where?: {
        "itemGroups.items.nonExistentField"?: string;
      };
    };
    itemGroups: {
      items: {};
    };
  };
};

type QHighInvalidWhereCheck =
  QHighInvalidWhere extends ValidQuery<QHighInvalidWhere, HighSchema>
    ? false
    : true;
const _qHighInvalidWhereCheck: QHighInvalidWhereCheck = true;








