import { domain, type DomainInstantSchema, type SchemaOf } from "..";
import { i } from "@instantdb/core";

// given: a materialized domain with entities and links.
const tasksDomain = domain("schema-extraction-tasks").schema({
  entities: {
    tasks: i.entity({
      title: i.string().indexed(),
      status: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

// when: schema helper types extract the InstantDB schema in the supported ways.
type TasksSchema = DomainInstantSchema<typeof tasksDomain>;
type TasksSchemaFromToInstantSchema = ReturnType<typeof tasksDomain.toInstantSchema>;
type TasksSchemaFromSchemaOf = SchemaOf<typeof tasksDomain>;

type DomainInstantSchemaMatchesToInstantSchema =
  TasksSchemaFromToInstantSchema extends TasksSchema
    ? TasksSchema extends TasksSchemaFromToInstantSchema
      ? true
      : false
    : false;
type SchemaOfMatchesInstantSchema =
  TasksSchemaFromSchemaOf extends TasksSchema
    ? TasksSchema extends TasksSchemaFromSchemaOf
      ? true
      : false
    : false;

// then: the helper aliases agree with the runtime instantSchema/toInstantSchema
// return type.
const _domainInstantSchemaMatchesToInstantSchema: DomainInstantSchemaMatchesToInstantSchema = true;
const _schemaOfMatchesInstantSchema: SchemaOfMatchesInstantSchema = true;
