import { PickerIcon } from "./PickerIcon";

export function PickerFooter() {
  return <footer className="project-picker__footer"><div className="project-picker__hints">
    <span><kbd><PickerIcon name="up" /></kbd><kbd><PickerIcon name="down" /></kbd>Navigate</span>
    <span><kbd>Enter</kbd>Select</span>
    <span><kbd>Backspace</kbd>Back</span>
    <span><kbd>Esc</kbd>Close</span>
  </div></footer>;
}
