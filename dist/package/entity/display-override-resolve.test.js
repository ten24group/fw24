"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const display_override_resolve_1 = require("./display-override-resolve");
describe('resolveWithDisplayOverrides', () => {
    it('returns stored value when no map', () => {
        expect((0, display_override_resolve_1.resolveWithDisplayOverrides)({
            storedValue: 'https://a.com/logo.png',
            overrideMap: undefined,
            fieldPath: 'homeTeamLogo',
        }).resolvedValue).toBe('https://a.com/logo.png');
    });
    it('uses override when map has path', () => {
        expect((0, display_override_resolve_1.resolveWithDisplayOverrides)({
            storedValue: 'https://synced.com/x.png',
            overrideMap: { homeTeamLogo: { value: 'https://admin.com/y.png', kind: 'value' } },
            fieldPath: 'homeTeamLogo',
        }).resolvedValue).toBe('https://admin.com/y.png');
    });
    it('ignores visibility-only entries for the resolved value', () => {
        const r = (0, display_override_resolve_1.resolveWithDisplayOverrides)({
            storedValue: 'https://synced.com/x.png',
            overrideMap: { homeTeamLogo: { kind: 'visibility' } },
            fieldPath: 'homeTeamLogo',
        });
        expect(r.resolvedValue).toBe('https://synced.com/x.png');
        expect(r.valueFromOverride).toBe(false);
    });
    it('works with readStoredValueAtPath directly for records', () => {
        const record = {
            teamLogo: 'a',
            displayOverrides: { teamLogo: { value: 'b' } },
        };
        const resolved = (0, display_override_resolve_1.resolveWithDisplayOverrides)({
            storedValue: (0, display_override_resolve_1.readStoredValueAtPath)(record, 'teamLogo'),
            overrideMap: record.displayOverrides,
            fieldPath: 'teamLogo',
        });
        expect(resolved.resolvedValue).toBe('b');
    });
});
describe('readStoredValueAtPath', () => {
    it('reads nested paths safely', () => {
        const r = { a: { b: 1 } };
        expect((0, display_override_resolve_1.readStoredValueAtPath)(r, 'a.b')).toBe(1);
        expect((0, display_override_resolve_1.readStoredValueAtPath)(r, 'a.missing')).toBeUndefined();
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGxheS1vdmVycmlkZS1yZXNvbHZlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Rpc3BsYXktb3ZlcnJpZGUtcmVzb2x2ZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEseUVBQWdHO0FBRWhHLFFBQVEsQ0FBQyw2QkFBNkIsRUFBRSxHQUFHLEVBQUU7SUFDM0MsRUFBRSxDQUFDLGtDQUFrQyxFQUFFLEdBQUcsRUFBRTtRQUMxQyxNQUFNLENBQ0osSUFBQSxzREFBMkIsRUFBQztZQUMxQixXQUFXLEVBQUUsd0JBQXdCO1lBQ3JDLFdBQVcsRUFBRSxTQUFTO1lBQ3RCLFNBQVMsRUFBRSxjQUFjO1NBQzFCLENBQUMsQ0FBQyxhQUFhLENBQ2pCLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDbkMsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsaUNBQWlDLEVBQUUsR0FBRyxFQUFFO1FBQ3pDLE1BQU0sQ0FDSixJQUFBLHNEQUEyQixFQUFDO1lBQzFCLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsV0FBVyxFQUFFLEVBQUUsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLHlCQUF5QixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsRUFBRTtZQUNsRixTQUFTLEVBQUUsY0FBYztTQUMxQixDQUFDLENBQUMsYUFBYSxDQUNqQixDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHdEQUF3RCxFQUFFLEdBQUcsRUFBRTtRQUNoRSxNQUFNLENBQUMsR0FBRyxJQUFBLHNEQUEyQixFQUFDO1lBQ3BDLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsV0FBVyxFQUFFLEVBQUUsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxFQUFFO1lBQ3JELFNBQVMsRUFBRSxjQUFjO1NBQzFCLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUM7UUFDekQsTUFBTSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMxQyxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyx1REFBdUQsRUFBRSxHQUFHLEVBQUU7UUFDL0QsTUFBTSxNQUFNLEdBQUc7WUFDYixRQUFRLEVBQUUsR0FBRztZQUNiLGdCQUFnQixFQUFFLEVBQUUsUUFBUSxFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO1NBQ3BCLENBQUM7UUFFN0IsTUFBTSxRQUFRLEdBQUcsSUFBQSxzREFBMkIsRUFBQztZQUMzQyxXQUFXLEVBQUUsSUFBQSxnREFBcUIsRUFBQyxNQUFNLEVBQUUsVUFBVSxDQUFDO1lBQ3RELFdBQVcsRUFBRSxNQUFNLENBQUMsZ0JBQTJDO1lBQy9ELFNBQVMsRUFBRSxVQUFVO1NBQ3RCLENBQUMsQ0FBQztRQUVILE1BQU0sQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzNDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUM7QUFFSCxRQUFRLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO0lBQ3JDLEVBQUUsQ0FBQywyQkFBMkIsRUFBRSxHQUFHLEVBQUU7UUFDbkMsTUFBTSxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQTZCLENBQUM7UUFDckQsTUFBTSxDQUFDLElBQUEsZ0RBQXFCLEVBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sQ0FBQyxJQUFBLGdEQUFxQixFQUFDLENBQUMsRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ2hFLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByZWFkU3RvcmVkVmFsdWVBdFBhdGgsIHJlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlcyB9IGZyb20gJy4vZGlzcGxheS1vdmVycmlkZS1yZXNvbHZlJztcblxuZGVzY3JpYmUoJ3Jlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlcycsICgpID0+IHtcbiAgaXQoJ3JldHVybnMgc3RvcmVkIHZhbHVlIHdoZW4gbm8gbWFwJywgKCkgPT4ge1xuICAgIGV4cGVjdChcbiAgICAgIHJlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlcyh7XG4gICAgICAgIHN0b3JlZFZhbHVlOiAnaHR0cHM6Ly9hLmNvbS9sb2dvLnBuZycsXG4gICAgICAgIG92ZXJyaWRlTWFwOiB1bmRlZmluZWQsXG4gICAgICAgIGZpZWxkUGF0aDogJ2hvbWVUZWFtTG9nbycsXG4gICAgICB9KS5yZXNvbHZlZFZhbHVlXG4gICAgKS50b0JlKCdodHRwczovL2EuY29tL2xvZ28ucG5nJyk7XG4gIH0pO1xuXG4gIGl0KCd1c2VzIG92ZXJyaWRlIHdoZW4gbWFwIGhhcyBwYXRoJywgKCkgPT4ge1xuICAgIGV4cGVjdChcbiAgICAgIHJlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlcyh7XG4gICAgICAgIHN0b3JlZFZhbHVlOiAnaHR0cHM6Ly9zeW5jZWQuY29tL3gucG5nJyxcbiAgICAgICAgb3ZlcnJpZGVNYXA6IHsgaG9tZVRlYW1Mb2dvOiB7IHZhbHVlOiAnaHR0cHM6Ly9hZG1pbi5jb20veS5wbmcnLCBraW5kOiAndmFsdWUnIH0gfSxcbiAgICAgICAgZmllbGRQYXRoOiAnaG9tZVRlYW1Mb2dvJyxcbiAgICAgIH0pLnJlc29sdmVkVmFsdWVcbiAgICApLnRvQmUoJ2h0dHBzOi8vYWRtaW4uY29tL3kucG5nJyk7XG4gIH0pO1xuXG4gIGl0KCdpZ25vcmVzIHZpc2liaWxpdHktb25seSBlbnRyaWVzIGZvciB0aGUgcmVzb2x2ZWQgdmFsdWUnLCAoKSA9PiB7XG4gICAgY29uc3QgciA9IHJlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlcyh7XG4gICAgICBzdG9yZWRWYWx1ZTogJ2h0dHBzOi8vc3luY2VkLmNvbS94LnBuZycsXG4gICAgICBvdmVycmlkZU1hcDogeyBob21lVGVhbUxvZ286IHsga2luZDogJ3Zpc2liaWxpdHknIH0gfSxcbiAgICAgIGZpZWxkUGF0aDogJ2hvbWVUZWFtTG9nbycsXG4gICAgfSk7XG4gICAgZXhwZWN0KHIucmVzb2x2ZWRWYWx1ZSkudG9CZSgnaHR0cHM6Ly9zeW5jZWQuY29tL3gucG5nJyk7XG4gICAgZXhwZWN0KHIudmFsdWVGcm9tT3ZlcnJpZGUpLnRvQmUoZmFsc2UpO1xuICB9KTtcblxuICBpdCgnd29ya3Mgd2l0aCByZWFkU3RvcmVkVmFsdWVBdFBhdGggZGlyZWN0bHkgZm9yIHJlY29yZHMnLCAoKSA9PiB7XG4gICAgY29uc3QgcmVjb3JkID0ge1xuICAgICAgdGVhbUxvZ286ICdhJyxcbiAgICAgIGRpc3BsYXlPdmVycmlkZXM6IHsgdGVhbUxvZ286IHsgdmFsdWU6ICdiJyB9IH0sXG4gICAgfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzKHtcbiAgICAgIHN0b3JlZFZhbHVlOiByZWFkU3RvcmVkVmFsdWVBdFBhdGgocmVjb3JkLCAndGVhbUxvZ28nKSxcbiAgICAgIG92ZXJyaWRlTWFwOiByZWNvcmQuZGlzcGxheU92ZXJyaWRlcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgIGZpZWxkUGF0aDogJ3RlYW1Mb2dvJyxcbiAgICB9KTtcblxuICAgIGV4cGVjdChyZXNvbHZlZC5yZXNvbHZlZFZhbHVlKS50b0JlKCdiJyk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdyZWFkU3RvcmVkVmFsdWVBdFBhdGgnLCAoKSA9PiB7XG4gIGl0KCdyZWFkcyBuZXN0ZWQgcGF0aHMgc2FmZWx5JywgKCkgPT4ge1xuICAgIGNvbnN0IHIgPSB7IGE6IHsgYjogMSB9IH0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZXhwZWN0KHJlYWRTdG9yZWRWYWx1ZUF0UGF0aChyLCAnYS5iJykpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHJlYWRTdG9yZWRWYWx1ZUF0UGF0aChyLCAnYS5taXNzaW5nJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgfSk7XG59KTtcbiJdfQ==