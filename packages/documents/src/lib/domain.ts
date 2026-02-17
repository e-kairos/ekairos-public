import { SchemaOf } from "@ekairos/domain";
import { documentDomain } from "./domain/document/schema";
import { documentProvidersDomain } from "./domain/document/providers/schema";

export const documentsDomain = documentDomain.compose(documentProvidersDomain);

export type DocumentsSchema = SchemaOf<typeof documentsDomain>;

export default documentsDomain;

