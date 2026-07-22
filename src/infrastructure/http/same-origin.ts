import { RealtimeError } from "@/features/realtime/domain/realtime-errors";

export function assertSameOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    requestUrl.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    requestUrl.protocol.replace(/:$/u, "");
  const expected = `${protocol}://${host}`;
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected)
    throw new RealtimeError(
      "INVALID_ORIGIN",
      "The request origin was not accepted.",
    );
}
