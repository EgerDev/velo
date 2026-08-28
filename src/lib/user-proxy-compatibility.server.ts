import type { ProxyId, ProxyProtocol } from "./proxy-operations.ts";
import type {
  ProxyVerdictInput,
  UserProxyRepository,
} from "./user-proxy-repository.server.ts";

export type CompatibilityProxyRow = {
  readonly id: ProxyId;
  readonly display: string;
  readonly protocol: ProxyProtocol;
  readonly ok: boolean | null;
  readonly exitIp: null;
  readonly checkedAt: number | null;
  readonly usable: boolean;
};

export class ProxySecretLease {
  readonly id: ProxyId;
  readonly protocol: ProxyProtocol;
  readonly #repository: UserProxyRepository;

  constructor(repository: UserProxyRepository, id: ProxyId, protocol: ProxyProtocol) {
    this.#repository = repository;
    this.id = id;
    this.protocol = protocol;
  }

  run<Result>(use: (url: string) => Promise<Result>): Promise<Result | null> {
    return this.#repository.withSecret(this.id, use);
  }

  mark(input: ProxyVerdictInput): Promise<void> {
    return this.#repository.rememberVerdict(this.id, input);
  }

  toJSON(): { readonly id: ProxyId; readonly protocol: ProxyProtocol } {
    return { id: this.id, protocol: this.protocol };
  }
}

export type UserProxyCompatibilityFacade = {
  readonly list: () => Promise<readonly CompatibilityProxyRow[]>;
  readonly active: () => Promise<ProxySecretLease | null>;
  readonly byId: (id: ProxyId) => Promise<ProxySecretLease | null>;
};

export function createUserProxyCompatibilityFacade(
  repository: UserProxyRepository,
): UserProxyCompatibilityFacade {
  const safeRows = () => repository.list();
  return {
    list: async () =>
      (await safeRows()).map((row) => ({
        id: row.id,
        display: row.maskedLabel,
        protocol: row.protocol,
        ok: row.verdict === "healthy" ? true : row.verdict === "unknown" ? null : false,
        exitIp: null,
        checkedAt: row.lastCheckedAt,
        usable: row.enabled && row.eligible,
      })),
    active: async () => {
      const row = (await safeRows()).find((candidate) => candidate.enabled && candidate.eligible);
      return row === undefined ? null : new ProxySecretLease(repository, row.id, row.protocol);
    },
    byId: async (id) => {
      const row = (await safeRows()).find((candidate) => candidate.id === id);
      return row === undefined ? null : new ProxySecretLease(repository, row.id, row.protocol);
    },
  };
}
