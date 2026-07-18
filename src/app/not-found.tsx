import Link from "next/link";
export default function NotFound() {
  return (
    <section className="card">
      <h1 style={{ fontSize: "3rem" }}>Not found</h1>
      <p className="muted">The requested practice interview does not exist.</p>
      <Link className="button" href="/history">
        View History
      </Link>
    </section>
  );
}
