export function ThanksStarLink() {
  return (
    <a
      aria-label="Turboism thanks"
      className="thanks-star-link ml-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
      href="https://turboism.dev/thanks"
      title="Thanks"
    >
      <svg
        aria-hidden="true"
        className="thanks-star-icon size-[18px]"
        fill="none"
        viewBox="0 0 28 28"
      >
        <path d="M14 1.75c.55 7.82 4.43 11.7 12.25 12.25C18.43 14.55 14.55 18.43 14 26.25 13.45 18.43 9.57 14.55 1.75 14 9.57 13.45 13.45 9.57 14 1.75Z" fill="currentColor" />
      </svg>
    </a>
  );
}
