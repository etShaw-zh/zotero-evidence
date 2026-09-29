import { extractProviderErrorMessage } from "./aiClient";
import { JevConfig } from "./jevConfig";

export type JevChoice = "include" | "exclude" | "unclear";

export interface JevDecisionAnswer {
  choice: JevChoice;
  confidence: number | null;
  probabilities: Record<string, number>;
}

export interface JevQuestionSpec {
  type: string;
  instructions: string;
  criteria: Record<string, string>;
}

/**
 * The single "decision" question sent with every call -- ported verbatim
 * (same instructions/criteria wording) from jev_ta_screening_eval.py, the
 * standalone script that validated this endpoint's request/response
 * contract before this feature existed. Keeping the wording identical
 * means results here stay comparable to that script's earlier runs.
 */
export const JEV_DECISION_QUESTIONS: Record<string, JevQuestionSpec> = {
  decision: {
    type: "choice",
    instructions:
      "Should this paper be included, excluded, or marked unclear for TA " +
      "screening, per the criteria and liberal-screening policy given in " +
      "the state?",
    criteria: {
      include:
        "Clearly satisfies the inclusion criteria, with no explicit conflict with the exclusion criteria.",
      exclude:
        "The title/abstract explicitly and clearly conflicts with the criteria (e.g. plainly non-empirical, non-educational, no AI component, not DBR, or protocol/WIP only).",
      unclear:
        "Required information is simply not stated in the title/abstract (not a clear conflict) -- needs full-text review to confirm.",
    },
  },
};

/**
 * Pulls and validates the `answers.decision` block out of a parsed JEV
 * response. Pure and HTTP-free on purpose (same reasoning as
 * usageService.ts's parseUsageFromResponse / ftCriterionCheckService.ts's
 * parseCriterionChecks) so this validation is unit-testable without a live
 * network call, which this test suite has no mocking harness for.
 */
export function parseJevAnswer(data: unknown): JevDecisionAnswer {
  const answer = (data as any)?.answers?.decision;
  const choice = answer?.choice;
  if (choice !== "include" && choice !== "exclude" && choice !== "unclear") {
    const providerMessage = extractProviderErrorMessage(data);
    throw new Error(
      providerMessage
        ? `JEV: ${providerMessage}`
        : "JEV response did not contain a valid answers.decision.choice",
    );
  }
  return {
    choice,
    confidence:
      typeof answer.confidence === "number" ? answer.confidence : null,
    probabilities:
      answer.probabilities && typeof answer.probabilities === "object"
        ? answer.probabilities
        : {},
  };
}

/**
 * One call to the JEV structured-decision endpoint (aihubmix's
 * /v1/systemone) -- NOT an OpenAI chat/completions shape, so this is its
 * own client rather than a callChatCompletion(...) call (aiClient.ts).
 * Uses Zotero.HTTP.request the same way callChatCompletion does; the
 * reference script's curl subprocess was only a workaround for that one
 * dev machine's TLS setup, not something to replicate inside Zotero's own
 * JS runtime (which has no subprocess access at all).
 *
 * `registerCanceler`, when given, is handed Zotero.HTTP.request's own
 * cancel function (via its `cancellerReceiver` option) so a caller can
 * abort this specific in-flight request -- see jevRunTracker.ts's
 * cancelers set, which is how the JEV dialog's "取消" button stops a
 * running batch instead of leaving it stuck with no way to interrupt it.
 */
export async function callJev(
  config: JevConfig,
  state: string,
  questions: Record<string, JevQuestionSpec> = JEV_DECISION_QUESTIONS,
  options: { registerCanceler?: (cancel: () => void) => () => void } = {},
): Promise<JevDecisionAnswer> {
  let unregister: (() => void) | undefined;
  try {
    const xhr = await Zotero.HTTP.request("POST", config.endpoint, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, state, questions }),
      responseType: "json",
      // JEV only ever sees a title/abstract (no full text) and responds
      // quickly in practice -- this is deliberately much shorter than
      // callChatCompletion's 300s full-text budget, so a request that
      // never actually leaves the client (a network/proxy issue upstream
      // of aihubmix, rather than the model itself being slow) is reported
      // back to the batch runner/UI in well under a minute instead of
      // silently sitting there looking "stuck".
      timeout: 60000,
      // Same reasoning as callChatCompletion (aiClient.ts): this is a
      // foreground call a batch run is actively waiting on, so a non-2xx
      // response should fail fast and let the caller record/report it,
      // not sit through Zotero.HTTP's default silent multi-minute retry.
      errorDelayMax: 0,
      cancellerReceiver: (canceller: () => void) => {
        unregister = options.registerCanceler?.(canceller);
      },
    });
    return parseJevAnswer(xhr.response);
  } catch (e: any) {
    const providerMessage = extractProviderErrorMessage(e?.xmlhttp?.response);
    if (providerMessage) {
      throw new Error(`JEV (HTTP ${e.status}): ${providerMessage}`, {
        cause: e,
      });
    }
    throw e;
  } finally {
    unregister?.();
  }
}
