declare module "suncalc" {
  export interface GetTimesResult {
    sunrise: Date;
    sunset: Date;
    sunriseEnd: Date;
    sunsetStart: Date;
    dawn: Date;
    dusk: Date;
    solarNoon: Date;
  }
  export interface GetPositionResult {
    altitude: number;
    azimuth: number;
  }
  export function getTimes(date: Date, latitude: number, longitude: number): GetTimesResult;
  export function getPosition(date: Date, latitude: number, longitude: number): GetPositionResult;
}
