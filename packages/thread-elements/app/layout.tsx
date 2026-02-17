import "./globals.css";

export const metadata = {
  title: "Ekairos Thread Elements Registry",
  description:
    "Registry landing and docs for AI Elements adapted to Ekairos Thread, Domain, and InstantDB.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
