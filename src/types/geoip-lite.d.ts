declare module "geoip-lite" {
  interface GeoLookup {
    range: [number, number];
    country: string;
    region: string;
    eu: string;
    timezone: string;
    city: string;
    ll: [number, number];
    metro: number;
    area: number;
  }
  function lookup(ip: string): GeoLookup | null;
  const geoip: { lookup: typeof lookup };
  export default geoip;
  export { lookup };
}
