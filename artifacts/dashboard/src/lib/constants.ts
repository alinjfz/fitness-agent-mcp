export const USER_ID = "demo_user";

const base = import.meta.env.BASE_URL ?? "/";
export const BASE_PATH = base.endsWith("/") ? base : base + "/";
