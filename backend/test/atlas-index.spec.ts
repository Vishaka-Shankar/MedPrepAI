import { ATLAS_INDEX_FILE, loadAtlasIndex, parseAtlasIndex, vectorField } from '../scripts/atlas-index';

describe('atlas_index.json (read by npm run db:setup)', () => {
  it('describes the 384-d bge-small index on embedding384 with subject and topic filters', () => {
    const index = loadAtlasIndex();
    expect(ATLAS_INDEX_FILE).toMatch(/rag-service[\\/]atlas_index\.json$/);
    expect(index.name).toBe('chunk_vector_index_384');
    expect(vectorField(index)).toEqual({ type: 'vector', path: 'embedding384', numDimensions: 384, similarity: 'cosine' });
    expect(index.definition.fields.filter((f) => f.type === 'filter').map((f) => f.path)).toEqual(['subjectId', 'topicId']);
  });

  it('rejects a broken file with a clear message', () => {
    expect(() => parseAtlasIndex({})).toThrow('"name"');
    expect(() => parseAtlasIndex({ name: 'x', type: 'vectorSearch', definition: {} })).toThrow('definition.fields');
    expect(() => parseAtlasIndex({ name: 'x', type: 'vectorSearch', definition: { fields: [{ type: 'filter', path: 'a' }] } })).toThrow(
      'exactly one vector field',
    );
    expect(() =>
      parseAtlasIndex({ name: 'x', type: 'vectorSearch', definition: { fields: [{ type: 'vector', path: 'e', numDimensions: '384' }] } }),
    ).toThrow('numDimensions');
  });
});
