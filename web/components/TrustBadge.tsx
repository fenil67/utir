interface TrustBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
}

function scoreColor(score: number | null): string {
  if (score === null) return "bg-gray-800 text-gray-400";
  if (score >= 80) return "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40";
  if (score >= 60) return "bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40";
  if (score >= 40) return "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40";
  return "bg-red-500/20 text-red-400 ring-1 ring-red-500/40";
}

const sizes = {
  sm: "text-xs px-2 py-0.5 rounded",
  md: "text-sm px-2.5 py-1 rounded-md",
  lg: "text-2xl font-bold w-16 h-16 rounded-xl flex items-center justify-center",
};

export default function TrustBadge({ score, size = "md" }: TrustBadgeProps) {
  return (
    <span className={`inline-flex items-center justify-center font-mono font-semibold tabular-nums ${scoreColor(score)} ${sizes[size]}`}>
      {score !== null ? score : "—"}
    </span>
  );
}
