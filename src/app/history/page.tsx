import { HistoryList } from "@/features/history/components/history-list";
export default function HistoryPage() {
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Local history</p>
        <h1 style={{ fontSize: "3rem" }}>Practice interviews</h1>
        <p className="lead">
          Search, continue, export, or permanently delete sessions stored in
          your local SQLite database.
        </p>
      </div>
      <HistoryList />
    </div>
  );
}
