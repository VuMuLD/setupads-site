export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initCronJobs } = await import("@/lib/jobs/cron-scheduler");
    initCronJobs();
  }
}
