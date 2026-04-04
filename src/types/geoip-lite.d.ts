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
  export default { lookup };
  export { lookup };
}
