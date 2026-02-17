import appDomain from "./lib/domain";

const schema = appDomain.toInstantSchema();
export type AppSchema = typeof schema;
export default schema;













