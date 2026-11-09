import { beforeEach, describe, expect, it, vi } from 'vitest';
const original = vi.hoisted(() => ({ direct: vi.fn(), project: vi.fn() }));
vi.mock('../../electron/main-room-root-admission.js', () => ({
  readOriginalMainDirectAdmission: original.direct,
  readOriginalMainRoomProjectAdmission: original.project,
}));
import {
  cacheOriginalMainAcceptedAdmission,
  readOptionalOriginalMainAcceptedAdmission,
} from '../../electron/main-accepted-root-binding.js';
// Fixed loader tests only; genuine membership has an actual Electron fixture.
describe('fixed original accepted-root binding cache', () => {
  beforeEach(() => {
    original.direct.mockReset();
    original.project.mockReset();
  });
  it('does not inspect unknown candidates', () => {
    let traps = 0;
    const candidate = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('getter');
        },
      },
    );
    expect(
      readOptionalOriginalMainAcceptedAdmission('kswarm_direct', candidate, {}),
    ).toBeNull();
    expect(traps).toBe(0);
    expect(original.direct).not.toHaveBeenCalled();
  });
  it('publishes pending and rechecks the original owner', async () => {
    const producer = {},
      service = {},
      port = Object.freeze({});
    original.direct.mockReturnValue(port);
    const loading = cacheOriginalMainAcceptedAdmission(
      'kswarm_direct',
      producer,
      service,
    );
    expect(() =>
      readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct',
        producer,
        service,
      ),
    ).toThrow('ROOT_RESOURCE_ACCEPTED_BINDING_PENDING');
    await loading;
    expect(
      readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct',
        producer,
        service,
      ),
    ).toBe(port);
    const error = Error('owner revoked');
    original.direct.mockImplementation(() => {
      throw error;
    });
    expect(() =>
      readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct',
        producer,
        service,
      ),
    ).toThrow(error);
  });
  it('rejects other kind and service without calling the owner', async () => {
    const producer = {},
      service = {};
    original.direct.mockReturnValue({});
    await cacheOriginalMainAcceptedAdmission(
      'kswarm_direct',
      producer,
      service,
    );
    original.direct.mockClear();
    expect(() =>
      readOptionalOriginalMainAcceptedAdmission(
        'room_project',
        producer,
        service,
      ),
    ).toThrow('ORIGINAL_ACCEPTED_BINDING_REQUIRED');
    await expect(
      cacheOriginalMainAcceptedAdmission('room_project', producer, service),
    ).rejects.toThrow('ORIGINAL_ACCEPTED_BINDING_REQUIRED');
    expect(() =>
      readOptionalOriginalMainAcceptedAdmission('kswarm_direct', producer, {}),
    ).toThrow('ORIGINAL_ACCEPTED_BINDING_REQUIRED');
    expect(original.direct).not.toHaveBeenCalled();
    expect(original.project).not.toHaveBeenCalled();
  });
  it('keeps a failed registration fenced', async () => {
    const producer = {},
      service = {},
      error = Error('membership denied');
    original.project.mockImplementation(() => {
      throw error;
    });
    await expect(
      cacheOriginalMainAcceptedAdmission('room_project', producer, service),
    ).rejects.toBe(error);
    original.project.mockReturnValue({});
    expect(() =>
      readOptionalOriginalMainAcceptedAdmission(
        'room_project',
        producer,
        service,
      ),
    ).toThrow(error);
    await expect(
      cacheOriginalMainAcceptedAdmission('room_project', producer, service),
    ).rejects.toBe(error);
    expect(original.project).toHaveBeenCalledTimes(1);
  });
});
