import { Validator } from '../validator';

describe('Advanced Validation Rules', () => {
  const validator = new Validator();

  it('should validate greaterThanField', async () => {
    const rules = {
      price: { greaterThanField: 'cost' }
    };
    const input = { price: 100, cost: 80 };
    const res = await validator.validateInput(input, rules as any);
    expect(res.pass).toBe(true);

    const inputFail = { price: 50, cost: 80 };
    const resFail = await validator.validateInput(inputFail, rules as any);
    expect(resFail.pass).toBe(false);
  });

  it('should validate requiredIf', async () => {
    const rules = {
      reason: { requiredIf: { field: 'status', value: 'rejected' } }
    };

    // Case 1: matches criteria and has value -> PASS
    const res1 = await validator.validateInput({ status: 'rejected', reason: 'bad data' }, rules as any);
    expect(res1.pass).toBe(true);

    // Case 2: matches criteria and MISSING value -> FAIL
    const res2 = await validator.validateInput({ status: 'rejected' }, rules as any);
    expect(res2.pass).toBe(false);

    // Case 3: does NOT match criteria and MISSING value -> PASS
    const res3 = await validator.validateInput({ status: 'approved' }, rules as any);
    expect(res3.pass).toBe(true);
  });

  it('should support array of requiredIf criteria', async () => {
    const rules = {
      meta: { requiredIf: [
        { field: 'type', value: 'internal' },
        { field: 'priority', value: 'high' }
      ]}
    };

    // Both match -> required
    const res1 = await validator.validateInput({ type: 'internal', priority: 'high' }, rules as any);
    expect(res1.pass).toBe(false);

    const res2 = await validator.validateInput({ type: 'internal', priority: 'high', meta: 'some info' }, rules as any);
    expect(res2.pass).toBe(true);

    // One doesn't match -> not required
    const res3 = await validator.validateInput({ type: 'external', priority: 'high' }, rules as any);
    expect(res3.pass).toBe(true);
  });
});
