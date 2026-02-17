
import { id, init } from '@instantdb/admin';


const LLAMA_CLOUD_BASE_URL = 'https://api.cloud.llamaindex.ai/api/v1';

interface DocumentPage {
    id: string;
    text: string;
}

export interface DocumentToProcess {
    buffer: Buffer;
    fileName: string;
    path: string;
    fileId: string;
}

interface LlamaParseUploadResponse {
    id: string;
    status: string;
}

interface LlamaParseStatusResponse {
    status: string;
}

interface LlamaParseResultResponse {
    markdown?: string;
    pages?: Array<{ page: number; text: string; }>;
}

/**
 * Sube un archivo a LlamaCloud para procesamiento
 */
async function uploadToLlamaCloud(buffer: Buffer, fileName: string): Promise<string> {
    const formData = new FormData();
    
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: 'application/pdf' });
    formData.append('file', blob, fileName);
    formData.append('parse_mode', 'parse_page_with_llm');
    formData.append('high_res_ocr', 'true');
    formData.append('adaptive_long_table', 'true');
    formData.append('outlined_table_extraction', 'true');
    formData.append('output_tables_as_HTML', 'true');

    const response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LlamaCloud upload failed: ${response.status} ${errorText}`);
    }

    const result: LlamaParseUploadResponse = await response.json();
    return result.id;
}

/**
 * Obtiene el estado del job de procesamiento
 */
async function getJobStatus(jobId: string): Promise<LlamaParseStatusResponse> {
    const response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/job/${jobId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LlamaCloud status fetch failed: ${response.status} ${errorText}`);
    }

    return await response.json();
}

/**
 * Obtiene el resultado del procesamiento de LlamaCloud
 */
async function getParseResult(jobId: string): Promise<LlamaParseResultResponse> {
    const response = await fetch(`${LLAMA_CLOUD_BASE_URL}/parsing/job/${jobId}/result/markdown`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}`,
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LlamaCloud result fetch failed: ${response.status} ${errorText}`);
    }

    return await response.json();
}

/**
 * Espera hasta que el procesamiento esté completo
 */
async function waitForProcessing(jobId: string, maxAttempts: number = 60): Promise<LlamaParseResultResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusResponse = await getJobStatus(jobId);
        
        console.log(`Job ${jobId} status: ${statusResponse.status} (attempt ${attempt + 1}/${maxAttempts})`);
        
        if (statusResponse.status === 'SUCCESS' || statusResponse.status === 'COMPLETED') {
            return await getParseResult(jobId);
        }
        
        if (statusResponse.status === 'ERROR' || statusResponse.status === 'FAILED') {
            throw new Error(`LlamaCloud processing failed with status: ${statusResponse.status}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('LlamaCloud processing timeout');
}

/**
 * Procesa un documento utilizando LlamaParse y almacena el resultado en la base de datos
 */
export async function parseAndStoreDocument(
    db: any,
    buffer: Buffer,
    fileName: string,
    path: string,
    fileId: string
): Promise<string> {
    try {
        const existingDocument = await db.query({
            document_documents: {
                $: {
                    where: { 'file.id': fileId }
                },
                file: {}
            }
        });

        if (existingDocument.documents && existingDocument.documents.length > 0) {
            const docId = existingDocument.documents[0].id;
            console.log(`Documento ya existe para el archivo ${fileName}: ${docId}`);
            return docId;
        }

        console.log(`Procesando nuevo documento: ${fileName}`);

        const jobId = await uploadToLlamaCloud(buffer, fileName);
        console.log(`Documento subido a LlamaCloud con job ID: ${jobId}`);

        const result = await waitForProcessing(jobId);
        
        const pages: DocumentPage[] = [];
        
        if (result.markdown) {
            pages.push({
                id: id(),
                text: result.markdown
            });
        }
        
        if (result.pages && result.pages.length > 0) {
            for (const page of result.pages) {
                pages.push({
                    id: id(),
                    text: page.text
                });
            }
        }

        if (pages.length === 0) {
            throw new Error('No se pudo extraer contenido del documento');
        }

        const documentId = id();
        await db.transact([
            db.tx.document_documents[documentId].update({
                content: { pages },
                processedAt: new Date().toISOString()
            }),
            db.tx.document_documents[documentId].link({
                file: fileId
            })
        ]);

        console.log(`Documento procesado con éxito: ${fileName} -> ${documentId}`);
        return documentId;
    } catch (error) {
        console.error(`Error al procesar el documento ${fileName}:`, error);
        throw error;
    }
}

/**
 * Procesa un conjunto de documentos en segundo plano
 * Puede ser utilizado con after() en Next.js o en cualquier contexto de procesamiento asíncrono
 */
export async function processBatchDocuments(db: any, documents: DocumentToProcess[]): Promise<string[]> {
    try {
        const promises = documents.map(doc =>
            parseAndStoreDocument(db, doc.buffer, doc.fileName, doc.path, doc.fileId)
        );

        const results = await Promise.all(promises);
        console.log('Todos los documentos procesados correctamente');
        return results;
    } catch (error) {
        console.error('Error en el procesamiento por lotes de documentos:', error);
        throw error;
    }
} 