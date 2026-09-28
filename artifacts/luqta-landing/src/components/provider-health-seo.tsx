import { useEffect } from 'react';

export function Seo({ title, description }: { title: string; description: string }) {
  useEffect(() => {
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute('content', description);
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, [description, title]);

  return null;
}