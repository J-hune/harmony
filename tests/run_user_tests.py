#!/usr/bin/env python3
"""
Script to run the user authentication test pipeline.
This script runs all the tests in test_user_auth.py.
"""

import unittest
import sys
import os

# Add the parent directory to the path so we can import from the main application
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_user_auth import TestUserAuth

if __name__ == '__main__':
    # Create a test suite
    suite = unittest.TestLoader().loadTestsFromTestCase(TestUserAuth)
    
    # Run the tests
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    
    # Exit with non-zero status if there were failures
    sys.exit(not result.wasSuccessful())