import { memo } from 'react';

const HeavyList = memo(({ items }: { items: string[] }) => (
  <ul>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
));

export default HeavyList;
