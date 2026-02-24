import { Context } from 'aws-lambda';

export const handler = async (event: any, _context: Context) => {
    console.log("🚀 Custom function invoked!", event);
    return {
        message: "Custom logic executed successfully"
    };
};
