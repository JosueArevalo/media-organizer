type StatCardProps = {
  title: string;
  value: string;
  hint: string;
};

export const StatCard = ({ title, value, hint }: StatCardProps) => {
  return (
    <article className="stat-card">
      <p className="stat-title">{title}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
    </article>
  );
};
