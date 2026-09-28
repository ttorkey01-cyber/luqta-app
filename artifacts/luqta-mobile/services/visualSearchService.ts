import type { ProductResult } from '@/types/search';
import { searchService } from '@/services/searchService';

export interface VisualSearchService {
  search(imageUri: string): Promise<{
    results: ProductResult[];
    demo: boolean;
    message: string;
  }>;
}

class DemoVisualSearchService implements VisualSearchService {
  async search(_imageUri: string) {
    return {
      results: await searchService.search('كرسي'),
      demo: true,
      message: 'نتائج تجريبية من البحث البصري المحلي — ربط التعرف الحقيقي يأتي لاحقاً.',
    };
  }
}

export const visualSearchService: VisualSearchService = new DemoVisualSearchService();