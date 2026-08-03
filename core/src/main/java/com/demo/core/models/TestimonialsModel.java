/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialsModel {

    @ChildResource
    private List<TestimonialQuote> quotes;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (quotes == null) quotes = new ArrayList<>();
        quotes.removeIf(q -> q == null || !q.isHasContent());
        hasContent = !quotes.isEmpty();
    }

    public List<TestimonialQuote> getQuotes() { return Collections.unmodifiableList(quotes); }
    public boolean isHasContent() { return hasContent; }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class TestimonialQuote {
        @ValueMapValue private String quote;
        @ValueMapValue private String name;
        @ValueMapValue private String title;

        public String getQuote() { return quote; }
        public String getName() { return name; }
        public String getTitle() { return title; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(quote);
        }
    }
}
