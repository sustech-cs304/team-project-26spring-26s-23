import type { ExternalSourcesSectionDomain as ExternalSourcesSectionViewDomain } from '../../ExternalSourcesSection'

export function createExternalSourcesSectionDomain(
  domain: ExternalSourcesSectionViewDomain,
): ExternalSourcesSectionViewDomain {
  return {
    ...domain,
  }
}
