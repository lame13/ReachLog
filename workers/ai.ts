import { aiReady } from "../src/modules/ai/client";
import { runAiAutomation } from "../src/modules/ai/worker";
import { env } from "../src/modules/core/env";
import { withWorkerLock } from "../src/modules/core/db/locks";
import { notifyWorkerFailure } from "../src/modules/core/worker-alerts";

async function main() {
  if (env.DEMO_MODE) {
    console.log("ai skipped: DEMO_MODE=true");
    return;
  }

  if (!aiReady()) {
    console.log("ai skipped: AI_ENABLED=false or provider settings are incomplete");
    return;
  }

  const summary = await withWorkerLock("ai", 1800, () => runAiAutomation());

  if (summary === null) {
    process.exitCode = 75;
    return;
  }

  console.log(
    `ai: triaged=${summary.triaged} drafts=${summary.followupsDrafted} sent=${summary.followupsSent} leads=${summary.leadsCaptured} errors=${summary.errors.length}`
  );
  for (const error of summary.errors.slice(0, 5)) console.error(error);
}

main().catch(async (error) => {
  console.error(error);
  await notifyWorkerFailure("ai", error);
  process.exitCode = 1;
});
