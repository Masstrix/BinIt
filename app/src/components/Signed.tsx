/**
 * Text that may start with a + or − (a delta or a gap). In the number font the sign sits a little below the
 * middle of the digits, so it is lifted to line up with them.
 */
export function Signed({ text }: { text: string }) {
  const m = /^([+−±-])(\d.*|)$/s.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className="sign">{m[1] === "-" ? "−" : m[1]}</span>
      {m[2]}
    </>
  );
}
