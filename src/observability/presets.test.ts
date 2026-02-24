import { productionPreset, developmentPreset, minimalPreset, debugPreset } from './presets';

describe('Observability presets', () => {
  it('enables operation normalization by default for production/development/minimal presets', () => {
    expect(productionPreset.operationNormalization?.enabled).toBe(true);
    expect(developmentPreset.operationNormalization?.enabled).toBe(true);
    expect(minimalPreset.operationNormalization?.enabled).toBe(true);
  });

  it('disables operation normalization for debug preset (raw ops)', () => {
    expect(debugPreset.operationNormalization?.enabled).toBe(false);
  });
});
