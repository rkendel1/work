export type IngressRecommendedAction = {
  title: string;
  description: string;
  action_type: string;
};

type Props = {
  recommendations: IngressRecommendedAction[];
};

export function IngressRecommendationsCard({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="rounded border p-3">
      <h3 className="font-medium">Recommended Actions</h3>
      <ul className="mt-2 space-y-2">
        {recommendations.map((recommendation, index) => (
          <li key={`${recommendation.title}-${index}`}>
            <p>□ {recommendation.title}</p>
            <p className="text-xs text-zinc-600">{recommendation.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
