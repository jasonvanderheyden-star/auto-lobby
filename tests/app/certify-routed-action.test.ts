import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockTx } = vi.hoisted(() => {
  const mockTx = {
    draftMcr: { updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    mockTx,
    mockDb: {
      draftMcr: { findMany: vi.fn() },
      tenant: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  certifyRoutedBatchAction,
  type CertifyRoutedState,
} from "@/app/certify/[token]/_actions";

const RAW_TOKEN = "Aq3xZ9_-bCdEfGhIjKlMnOpQrStUvWxYz012345abcd"; // 43 chars, base64url alphabet
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");
const IDLE: CertifyRoutedState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function validForm(): FormData {
  return form({
    token: RAW_TOKEN,
    typedName: "Jane Responsible Officer",
    attested: "on",
  });
}

function routedDraftRow(id: string, startAt: string) {
  return {
    id,
    subjects: [],
    provenance: {},
    routedToEmail: "ro@client.ca",
    routingTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    meeting: {
      id: `meeting-${id}`,
      tenantId: "t1",
      title: "Meeting",
      startAt: new Date(startAt),
      institution: null,
      attendees: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.draftMcr.findMany.mockResolvedValue([
    routedDraftRow("d1", "2026-05-04T15:00:00.000Z"),
    routedDraftRow("d2", "2026-05-20T18:00:00.000Z"),
  ]);
  mockDb.tenant.findUnique.mockResolvedValue({
    id: "t1",
    name: "Client Corp",
    productName: null,
    logoUrl: null,
    brandColor: null,
    supportEmail: null,
    agency: null,
  });
  mockTx.draftMcr.updateMany.mockResolvedValue({ count: 2 });
  mockTx.auditEvent.create.mockResolvedValue({});
});

describe("certifyRoutedBatchAction — happy path", () => {
  it("certifies the batch and consumes the token (hash cleared = single use)", async () => {
    const result = await certifyRoutedBatchAction(IDLE, validForm());

    expect(result.status).toBe("success");
    expect(result.count).toBe(2);
    expect(result.monthLabel).toBe("May 2026");

    expect(mockTx.draftMcr.updateMany).toHaveBeenCalledTimes(1);
    const update = mockTx.draftMcr.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Conditional update keyed on the hash + unexpired + uncertified
    expect(update.where).toMatchObject({
      id: { in: ["d1", "d2"] },
      routingTokenHash: TOKEN_HASH,
      certifiedAt: null,
    });
    // Single use: the hash dies with certification
    expect(update.data.routingTokenHash).toBeNull();
    expect(update.data.routingTokenExpiresAt).toBeNull();
    expect(update.data.certifiedAt).toBeInstanceOf(Date);
    // Routed RO has no app account
    expect(update.data.certifiedByUserId).toBeNull();
  });

  it("writes a batch-certified audit event with the typed name, no raw token", async () => {
    await certifyRoutedBatchAction(IDLE, validForm());

    const audit = mockTx.auditEvent.create.mock.calls[0]![0] as {
      data: {
        action: string;
        actor: string;
        actorRole: string | null;
        payload: { via: string; typedName: string; month: string };
      };
    };
    expect(audit.data.action).toBe("batch-certified");
    expect(audit.data.actorRole).toBe("registrant");
    expect(audit.data.actor).toBe("ro@client.ca");
    expect(audit.data.payload.via).toBe("routed-link");
    expect(audit.data.payload.typedName).toBe("Jane Responsible Officer");
    expect(JSON.stringify(audit)).not.toContain(RAW_TOKEN);
  });
});

describe("certifyRoutedBatchAction — single use & revocation", () => {
  it("fails when the conditional update matches zero rows (token already consumed)", async () => {
    mockTx.draftMcr.updateMany.mockResolvedValue({ count: 0 });

    const result = await certifyRoutedBatchAction(IDLE, validForm());

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/already used|revoked/i);
    expect(mockTx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("fails when the token resolves to no batch (expired / revoked / used)", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([]);

    const result = await certifyRoutedBatchAction(IDLE, validForm());

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/no longer valid/i);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("certifyRoutedBatchAction — input validation (non-negotiable #1)", () => {
  it("rejects a missing attestation checkbox", async () => {
    const result = await certifyRoutedBatchAction(
      IDLE,
      form({ token: RAW_TOKEN, typedName: "Jane Responsible Officer" }),
    );
    expect(result.status).toBe("error");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a too-short typed name", async () => {
    const result = await certifyRoutedBatchAction(
      IDLE,
      form({ token: RAW_TOKEN, typedName: "JR", attested: "on" }),
    );
    expect(result.status).toBe("error");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed token without touching the database", async () => {
    const result = await certifyRoutedBatchAction(
      IDLE,
      form({ token: "short!token", typedName: "Jane RO", attested: "on" }),
    );
    expect(result.status).toBe("error");
    expect(mockDb.draftMcr.findMany).not.toHaveBeenCalled();
  });
});
