import chalk, { type ChalkInstance } from 'chalk'; // Import the ChalkInstance type

// Basic logger utility using chalk

// Define colors for consistency
const levelColors = {
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red.bold,
    debug: chalk.gray,
    success: chalk.green,
    startup: chalk.magenta.bold,
    path: chalk.cyan.bold,
    database: chalk.blue.bold,
};
const moduleColor = chalk.cyan;
const timestampColor = chalk.gray;

// Specific entity colors
const entityColors = {
    attacker: chalk.red,
    victim: chalk.cyan, // Using cyan for victims to contrast with red attackers
    ship: chalk.yellow,
    weapon: chalk.magenta,
    location: chalk.blueBright,
    status: chalk.greenBright,
    id: chalk.bold,
    level: chalk.bold,
    player: chalk.green, // Color for the current player's name
    // Add more as needed
};

// Keywords to color
const keywordColors: { [key: string]: ChalkInstance } = {
    'destroyed': levelColors.error,
    'crashed': levelColors.error,
    'disabled': levelColors.warn,
    'damaged': levelColors.warn,
    'skipped': levelColors.debug,
    'suppressed': levelColors.debug,
    'failed': levelColors.error,
    'error': levelColors.error,
    'success': levelColors.success,
    'updated': levelColors.success,
    'added': levelColors.success,
    'removed': levelColors.warn,
    'started': levelColors.success,
    'stopped': levelColors.info,
    'created': levelColors.success,
};

// Base log function
// Helper to process arguments for specific coloring
function processArgsForColoring(args: any[]): string[] {
    return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            // Check for specific entity keys
            for (const key in entityColors) {
                if (arg[key] !== undefined) {
                    // Apply color and return string representation
                    return (entityColors as any)[key](arg[key]);
                }
            }
            // If it's an object but not a specific entity, stringify it (basic handling)
            try {
                return JSON.stringify(arg);
            } catch {
                return '[Object]';
            }
        }
        if (typeof arg === 'string') {
            // Check if the string matches a keyword
            const lowerArg = arg.toLowerCase();
            if (keywordColors[lowerArg]) {
                return keywordColors[lowerArg](arg); // Apply keyword color
            }
            // Return the string as is if no keyword match
            return arg;
        }
        // Handle other types (numbers, booleans, etc.)
        return String(arg);
    });
}


// Base log function
function log(levelColor: ChalkInstance, moduleName: string, ...args: any[]) {
    const timestamp = new Date().toLocaleTimeString();
    // Process args for specific entity/keyword coloring first
    const processedArgs = processArgsForColoring(args);

    // Apply the main level color to the entire message string after joining processed parts
    const message = processedArgs.join(' ');

    console.log(
        `${timestampColor(timestamp)} ${moduleColor(`[${moduleName}]`)}`, // Timestamp and Module Name
        levelColor(message) // Apply level color to the whole message string
    );
}

// Specific level functions
// Specific level functions call the modified log
export function info(moduleName: string, ...args: any[]) {
    log(levelColors.info, moduleName, ...args);
}

export function warn(moduleName: string, ...args: any[]) {
    log(levelColors.warn, moduleName, ...args);
}

export function error(moduleName: string, ...args: any[]) {
    log(levelColors.error, moduleName, ...args);
}

export function debug(moduleName: string, ...args: any[]) {
    // Optional: Could add a check here based on an environment variable
    // if (process.env.NODE_ENV !== 'production') {
         log(levelColors.debug, moduleName, ...args);
    // }
}

export function success(moduleName: string, ...args: any[]) {
    log(levelColors.success, moduleName, ...args);
}

export function startup(moduleName: string, ...args: any[]) {
    const timestamp = new Date().toLocaleTimeString();
    const processedArgs = processArgsForColoring(args);
    const message = processedArgs.join(' ');
    console.log(
        `${timestampColor(timestamp)} ${chalk.magenta(`[${moduleName}]`)}`,
        chalk.magenta('>>'), 
        chalk.white(message)
    );
}

export function path(moduleName: string, label: string, filePath: string) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(
        `${timestampColor(timestamp)} ${moduleColor(`[${moduleName}]`)}`,
        chalk.cyan('[PATH]'),
        chalk.white(`${label}:`),
        chalk.cyan(filePath)
    );
}

export function database(moduleName: string, ...args: any[]) {
    const timestamp = new Date().toLocaleTimeString();
    const processedArgs = processArgsForColoring(args);
    const message = processedArgs.join(' ');
    console.log(
        `${timestampColor(timestamp)} ${moduleColor(`[${moduleName}]`)}`,
        chalk.blue('[DB]'),
        chalk.white(message)
    );
}

// No extra closing brace needed

// You can also export chalk directly if needed elsewhere, though maybe unnecessary now
// export { chalk }; // Keep chalk export commented unless needed