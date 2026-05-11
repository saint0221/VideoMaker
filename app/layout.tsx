import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube PD — 스토리텔링 자동 생산",
  description: "유튜브 스토리텔링 채널의 기획부터 대본까지 자동화",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
