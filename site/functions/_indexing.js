// A fresh catalog entry is useful to visitors, but should not become a search
// landing page until its own price history adds information beyond the retailer.
export const MIN_PRICE_HISTORY_DAYS=7;
export const MIN_COLLECTION_OFFERS=3;

export function indexableOffer(offer,observations) {
  return offer?.availability==='active'&&Number(observations)>=MIN_PRICE_HISTORY_DAYS;
}

export function indexableCollection(count) {
  return Number(count)>=MIN_COLLECTION_OFFERS;
}
