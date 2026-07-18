export interface RealtimeInterviewClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
