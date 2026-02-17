import { i } from "@instantdb/core";
import type { EntitiesDef, LinksDef, RoomsDef, InstantSchemaDef } from "@instantdb/core";

export type DomainDefinition<E extends EntitiesDef, L extends LinksDef<any>, R extends RoomsDef> = {
  entities: E;
  links: L;
  rooms: R;
};

export type DomainInstance<E extends EntitiesDef, L extends LinksDef<any>, R extends RoomsDef> = DomainDefinition<E, L, R> & {
  schema: () => ReturnType<typeof i.schema>;
  compose: <E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ) => DomainInstance<E & E2, LinksDef<E & E2>, R & R2>;
};

export type SchemaOf<D extends DomainDefinition<any, any, any>> = InstantSchemaDef<D["entities"], LinksDef<D["entities"]>, D["rooms"]>;

export function domain<E extends EntitiesDef, L extends LinksDef<any>, R extends RoomsDef>(
  def: DomainDefinition<E, L, R>
): DomainInstance<E, L, R> {
  function schema() {
    return i.schema({
      entities: def.entities as E,
      links: def.links as L,
      rooms: def.rooms as R,
    });
  }

  function compose<E2 extends EntitiesDef, L2 extends LinksDef<E2>, R2 extends RoomsDef>(
    other: DomainInstance<E2, L2, R2> | DomainDefinition<E2, L2, R2>
  ): DomainInstance<E & E2, LinksDef<E & E2>, R & R2> {
    const otherDef = ("schema" in other)
      ? { entities: other.entities, links: other.links, rooms: other.rooms }
      : other;

    const mergedEntities = { ...def.entities, ...otherDef.entities } as E & E2;
    const mergedLinks = { ...(def.links as object), ...(otherDef.links as object) } as LinksDef<E & E2>;
    const mergedRooms = { ...def.rooms, ...otherDef.rooms } as R & R2;

    return domain({
      entities: mergedEntities,
      links: mergedLinks,
      rooms: mergedRooms,
    }) as DomainInstance<E & E2, LinksDef<E & E2>, R & R2>;
  }

  return {
    entities: def.entities,
    links: def.links,
    rooms: def.rooms,
    schema,
    compose,
  } as DomainInstance<E, L, R>;
}


