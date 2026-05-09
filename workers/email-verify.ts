import { env } from "../src/modules/core/env";
import { withWorkerLock } from "../src/modules/core/db/locks";
import { notifyWorkerFailure } from "../src/modules/core/worker-alerts";
import { verifyPendingContacts } from "../src/modules/emailVerification/service";

async function main() {
  if (!env.EMAILLISTVERIFY_ENABLED || !env.EMAILLISTVERIFY_API_KEY) {
    console.log("email-verify skipped: EmailListVerify not configured");
    return;
  }

  await withWorkerLock("email-verify", 300, async () => {
    const result = await verifyPendingContacts(env.EMAILLISTVERIFY_BATCH_SIZE);
    console.log(`email-verify: ${result.checked} checked`);
  });
}

main().catch(async (error) => {
  console.error(error);
  await notifyWorkerFailure("email-verify", error);
  process.exitCode = 1;
});
