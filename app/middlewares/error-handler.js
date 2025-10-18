
function errorHandler(error, req, res, next) {
    console.error('Unhandled error:', error);
    
    if (error.message && error.message.includes('fabric')) {
        return res.status(503).json({
            success: false,
            error: 'Fabric network error',
            details: error.message
        });
    }

    if (error.message && (error.message.includes('certificate') || error.message.includes('TLS'))) {
        return res.status(503).json({
            success: false,
            error: 'Certificate/TLS error',
            details: error.message,
            suggestion: 'Please check network connectivity and certificate paths'
        });
    }

    if (error.message && error.message.includes('chaincode')) {
        return res.status(400).json({
            success: false,
            error: 'Chaincode error',
            details: error.message
        });
    }

    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation error',
            details: error.message
        });
    }

    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
}

function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.path}`
    });
}

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};