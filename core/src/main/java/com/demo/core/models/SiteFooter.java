package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class SiteFooter {

    @ValueMapValue
    private String quoteText;

    @ValueMapValue
    private String quoteAttribution;

    @ValueMapValue
    private String copyright;

    @ValueMapValue
    private String brandLabel;

    @ValueMapValue
    private String brandHref;

    @ValueMapValue
    private String cookieLabel;

    @ValueMapValue
    private String cookieHref;

    @ValueMapValue
    private String languageLabel;

    @ChildResource
    private List<LinkGroup> linkGroups;

    public String getQuoteText() {
        return quoteText;
    }

    public String getQuoteAttribution() {
        return quoteAttribution;
    }

    public String getCopyright() {
        return copyright;
    }

    public String getBrandLabel() { return brandLabel; }

    public String getBrandHref() { return brandHref; }

    public String getCookieLabel() { return cookieLabel; }

    public String getCookieHref() { return cookieHref; }

    public String getLanguageLabel() { return languageLabel; }

    public List<LinkGroup> getLinkGroups() {
        if (linkGroups == null) {
            return Collections.emptyList();
        }
        return linkGroups.stream()
                .filter(LinkGroup::hasContent)
                .collect(Collectors.toList());
    }

    public boolean isHasContent() {
        return (quoteText != null && !quoteText.isEmpty())
                || (copyright != null && !copyright.isEmpty())
                || !getLinkGroups().isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class LinkGroup {
        @ValueMapValue
        private String heading;

        @ChildResource
        private List<Link> links;

        public String getHeading() {
            return heading;
        }

        public List<Link> getLinks() {
            if (links == null) {
                return Collections.emptyList();
            }
            return links.stream()
                    .filter(Link::hasContent)
                    .collect(Collectors.toList());
        }

        public boolean hasContent() {
            return (heading != null && !heading.trim().isEmpty()) || !getLinks().isEmpty();
        }
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Link {
        @ValueMapValue
        private String label;

        @ValueMapValue
        private String href;

        public String getLabel() {
            return label;
        }

        public String getHref() {
            return href;
        }

        public boolean hasContent() {
                return label != null && !label.trim().isEmpty()
                    && href != null && !href.trim().isEmpty();
        }
    }
}
