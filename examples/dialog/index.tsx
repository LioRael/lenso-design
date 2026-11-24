import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@ui-sdk/solid/dialog";
import { root, parts } from "./recipe";

export function DetailsDialog(props: { container: HTMLElement }) {
  return (
    <Dialog container={props.container}>
      <DialogTrigger class={parts.action}>Show details</DialogTrigger>
      <DialogContent class={root} initialFocus="button" finalFocus="trigger">
        <DialogTitle>Project details</DialogTitle>
        <DialogDescription>Settings for the current project.</DialogDescription>
        <DialogClose class={parts.action}>Close details</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
