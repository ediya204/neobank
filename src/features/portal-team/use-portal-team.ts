import { useCallback, useEffect, useState } from 'react';
import {
  createPortalTeamRole,
  deletePortalTeamRole,
  getPortalTeamOverview,
  invitePortalTeamMember,
  PortalTeamApiError,
  revokePortalTeamInvitation,
  updatePortalTeamMember,
  updatePortalTeamRole,
} from './api';
import {
  CreatePortalTeamRoleInput,
  InvitePortalTeamMemberInput,
  PortalTeamInvitationCreateResult,
  PortalTeamMutation,
  PortalTeamOverview,
  UpdatePortalTeamMemberInput,
  UpdatePortalTeamRoleInput,
} from './types';

type PortalTeamError = {
  code: string;
  requestId: string;
};

function normalizeError(error: unknown): PortalTeamError {
  if (error instanceof PortalTeamApiError) {
    return { code: error.code, requestId: error.requestId };
  }
  return { code: 'request_failed', requestId: '' };
}

export default function usePortalTeam() {
  const [overview, setOverview] = useState<PortalTeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<PortalTeamError | null>(null);
  const [mutationError, setMutationError] = useState<PortalTeamError | null>(null);
  const [mutation, setMutation] = useState<PortalTeamMutation>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      setOverview(await getPortalTeamOverview(signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLoadError(normalizeError(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const mutate = useCallback(
    async <T>(kind: Exclude<PortalTeamMutation, null>, action: () => Promise<T>) => {
      setMutation(kind);
      setMutationError(null);
      try {
        const result = await action();
        await load();
        return result;
      } catch (error) {
        const normalized = normalizeError(error);
        setMutationError(normalized);
        throw error;
      } finally {
        setMutation(null);
      }
    },
    [load]
  );

  const invite = useCallback(
    (input: InvitePortalTeamMemberInput): Promise<PortalTeamInvitationCreateResult> =>
      mutate('invite', () => invitePortalTeamMember(input)),
    [mutate]
  );

  const revokeInvitation = useCallback(
    (invitationId: string) =>
      mutate('revoke-invitation', () => revokePortalTeamInvitation(invitationId)),
    [mutate]
  );

  const updateMember = useCallback(
    (memberId: string, input: UpdatePortalTeamMemberInput) =>
      mutate('update-member', () => updatePortalTeamMember(memberId, input)),
    [mutate]
  );

  const createRole = useCallback(
    (input: CreatePortalTeamRoleInput) => mutate('create-role', () => createPortalTeamRole(input)),
    [mutate]
  );

  const updateRole = useCallback(
    (roleId: string, input: UpdatePortalTeamRoleInput) =>
      mutate('update-role', () => updatePortalTeamRole(roleId, input)),
    [mutate]
  );

  const deleteRole = useCallback(
    (roleId: string, version: number) =>
      mutate('delete-role', () => deletePortalTeamRole(roleId, version)),
    [mutate]
  );

  return {
    overview,
    loading,
    loadError,
    mutation,
    mutationError,
    reload: load,
    invite,
    revokeInvitation,
    updateMember,
    createRole,
    updateRole,
    deleteRole,
  };
}
