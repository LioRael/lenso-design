import { DetailsDialog } from "./components/details-dialog";

export function ProjectDetails(props: { portal: HTMLElement }) {
  return (
    <section aria-label="Project overview" style={{ background: "var(--ds-surface-canvas)" }}>
      <DetailsDialog container={props.portal} />
    </section>
  );
}
