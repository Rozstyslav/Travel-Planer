from django.shortcuts import render

def home(request):
    """The public travel planner; authenticated operations use the existing API."""
    return render(request, "travel/index.html")
