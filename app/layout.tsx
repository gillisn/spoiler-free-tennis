import "./globals.css";

export const metadata = {
  title: "Spoiler Free Tennis",
  description: "The best matches from the last 24 hours of Grand Slam tennis — no scores, no times, just what to watch.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
