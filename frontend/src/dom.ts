type ScrollTarget = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => unknown;
};

export function scrollMessageIntoView(target: ScrollTarget | null): void {
  target?.scrollIntoView({ behavior: "smooth" });
}
