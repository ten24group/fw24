"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const otel_links_1 = require("./otel-links");
describe('OTEL causedBy links', () => {
    it('creates a span link for causedBy (and never uses it as parent)', () => {
        const links = (0, otel_links_1.buildCausedByLinks)({
            correlationId: 'local-corr',
            causedBy: 'upstream-corr-123',
        });
        expect(links.length).toBe(1);
        expect(links[0].attributes).toMatchObject({
            'fw24.link.kind': 'causedBy',
            'fw24.caused_by': 'upstream-corr-123',
        });
    });
    it('does not create a self-link when causedBy == correlationId', () => {
        const links = (0, otel_links_1.buildCausedByLinks)({
            correlationId: 'same',
            causedBy: 'same',
        });
        expect(links.length).toBe(0);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC1jYXVzZWRieS1saW5rcy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvYmFja2VuZHMvb3RlbC1jYXVzZWRieS1saW5rcy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNkNBQWtEO0FBRWxELFFBQVEsQ0FBQyxxQkFBcUIsRUFBRSxHQUFHLEVBQUU7SUFDbkMsRUFBRSxDQUFDLGdFQUFnRSxFQUFFLEdBQUcsRUFBRTtRQUN4RSxNQUFNLEtBQUssR0FBRyxJQUFBLCtCQUFrQixFQUFDO1lBQy9CLGFBQWEsRUFBRSxZQUFZO1lBQzNCLFFBQVEsRUFBRSxtQkFBbUI7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDN0IsTUFBTSxDQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxhQUFhLENBQUM7WUFDMUMsZ0JBQWdCLEVBQUUsVUFBVTtZQUM1QixnQkFBZ0IsRUFBRSxtQkFBbUI7U0FDdEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsNERBQTRELEVBQUUsR0FBRyxFQUFFO1FBQ3BFLE1BQU0sS0FBSyxHQUFHLElBQUEsK0JBQWtCLEVBQUM7WUFDL0IsYUFBYSxFQUFFLE1BQU07WUFDckIsUUFBUSxFQUFFLE1BQU07U0FDakIsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGJ1aWxkQ2F1c2VkQnlMaW5rcyB9IGZyb20gJy4vb3RlbC1saW5rcyc7XG5cbmRlc2NyaWJlKCdPVEVMIGNhdXNlZEJ5IGxpbmtzJywgKCkgPT4ge1xuICBpdCgnY3JlYXRlcyBhIHNwYW4gbGluayBmb3IgY2F1c2VkQnkgKGFuZCBuZXZlciB1c2VzIGl0IGFzIHBhcmVudCknLCAoKSA9PiB7XG4gICAgY29uc3QgbGlua3MgPSBidWlsZENhdXNlZEJ5TGlua3Moe1xuICAgICAgY29ycmVsYXRpb25JZDogJ2xvY2FsLWNvcnInLFxuICAgICAgY2F1c2VkQnk6ICd1cHN0cmVhbS1jb3JyLTEyMycsXG4gICAgfSk7XG5cbiAgICBleHBlY3QobGlua3MubGVuZ3RoKS50b0JlKDEpO1xuICAgIGV4cGVjdChsaW5rc1sgMCBdLmF0dHJpYnV0ZXMpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgJ2Z3MjQubGluay5raW5kJzogJ2NhdXNlZEJ5JyxcbiAgICAgICdmdzI0LmNhdXNlZF9ieSc6ICd1cHN0cmVhbS1jb3JyLTEyMycsXG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdkb2VzIG5vdCBjcmVhdGUgYSBzZWxmLWxpbmsgd2hlbiBjYXVzZWRCeSA9PSBjb3JyZWxhdGlvbklkJywgKCkgPT4ge1xuICAgIGNvbnN0IGxpbmtzID0gYnVpbGRDYXVzZWRCeUxpbmtzKHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdzYW1lJyxcbiAgICAgIGNhdXNlZEJ5OiAnc2FtZScsXG4gICAgfSk7XG4gICAgZXhwZWN0KGxpbmtzLmxlbmd0aCkudG9CZSgwKTtcbiAgfSk7XG59KTtcblxuXG4iXX0=