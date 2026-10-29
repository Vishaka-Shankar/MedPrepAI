import * as fs from 'fs';
import * as path from 'path';

/**
 * The Atlas Vector Search index for chunks, read from rag-service/atlas_index.json.
 * That file is generated from rag-service/config.py (the single source for the embedding
 * model's name, dimensions, field and index), so the backend never hard-codes them.
 */
export const ATLAS_INDEX_FILE = path.resolve(__dirname, '../../rag-service/atlas_index.json');

export interface VectorField {
  type: 'vector';
  path: string;
  numDimensions: number;
  similarity: 'cosine' | 'euclidean' | 'dotProduct';
}

export interface FilterField {
  type: 'filter';
  path: string;
}

export interface AtlasVectorIndex {
  name: string;
  type: 'vectorSearch';
  definition: { fields: Array<VectorField | FilterField> };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Checks the shape, so a broken file fails here with a clear message instead of inside Atlas. */
export function parseAtlasIndex(json: unknown): AtlasVectorIndex {
  if (!isObject(json) || typeof json.name !== 'string' || !json.name || json.type !== 'vectorSearch') {
    throw new Error('atlas_index.json must have a "name" and "type": "vectorSearch"');
  }
  const fields = isObject(json.definition) ? json.definition.fields : undefined;
  if (!Array.isArray(fields)) throw new Error('atlas_index.json must have "definition.fields"');
  const vectors = fields.filter((f) => isObject(f) && f.type === 'vector');
  if (vectors.length !== 1) throw new Error('atlas_index.json must have exactly one vector field');
  const vector = vectors[0] as Record<string, unknown>;
  if (typeof vector.path !== 'string' || !Number.isInteger(vector.numDimensions) || (vector.numDimensions as number) < 1) {
    throw new Error('the vector field in atlas_index.json needs a "path" and a whole-number "numDimensions"');
  }
  return json as unknown as AtlasVectorIndex;
}

export function loadAtlasIndex(file: string = ATLAS_INDEX_FILE): AtlasVectorIndex {
  return parseAtlasIndex(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function vectorField(index: AtlasVectorIndex): VectorField {
  return index.definition.fields.find((f): f is VectorField => f.type === 'vector') as VectorField;
}
