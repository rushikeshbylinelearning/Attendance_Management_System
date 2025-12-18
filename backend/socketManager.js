// backend/socketManager.js

let io = null;

/**
 * Sets the global socket.io instance.
 * This should be called only once in server.js after initialization.
 * @param {object} socketInstance - The socket.io server instance.
 */
const setIO = (socketInstance) => {
    io = socketInstance;
};

/**
 * Gets the global socket.io instance.
 * @returns {object} The socket.io server instance.
 */
const getIO = () => {
    if (!io) {
        throw new Error('Socket.io has not been initialized!');
    }
    return io;
};

module.exports = { setIO, getIO };