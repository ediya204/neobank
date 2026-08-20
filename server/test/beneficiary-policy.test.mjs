import assert from 'node:assert/strict';
import test from 'node:test';
import { BeneficiariesController } from '../dist/src/beneficiaries/beneficiaries.controller.js';

const request = { header: (name) => (name === 'x-user-id' ? 'admin_1' : undefined) };

function database() {
  const updates = [];
  return {
    updates,
    user: {
      findUnique: async () => ({
        id: 'admin_1',
        active: true,
        organizationId: 'org_1',
        role: 'ADMIN',
      }),
    },
    beneficiary: {
      findUnique: async () => ({ id: 'beneficiary_1', customer: { organizationId: 'org_1' } }),
      update: async (input) => {
        updates.push(input);
        return input;
      },
    },
  };
}

test('beneficiary update cannot mutate payout destination fields', async () => {
  const db = database();
  const controller = new BeneficiariesController(db);
  await controller.update(
    'beneficiary_1',
    { active: false, iban: 'ATTACKER-IBAN', swiftBic: 'ATTACKER' },
    request
  );
  assert.deepEqual(db.updates, [{ where: { id: 'beneficiary_1' }, data: { active: false } }]);
});

test('beneficiary destination-only patch is rejected', async () => {
  const controller = new BeneficiariesController(database());
  await assert.rejects(
    controller.update('beneficiary_1', { iban: 'ATTACKER-IBAN' }, request),
    /beneficiary_destination_immutable/
  );
});
